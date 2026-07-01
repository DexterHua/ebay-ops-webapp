import { inflateRawSync } from "node:zlib";
import { XMLParser } from "fast-xml-parser";

type ZipEntry = {
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function toBuffer(input: ArrayBuffer | Uint8Array | Buffer): Buffer {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  return Buffer.from(input);
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error("无法读取 XLSX 文件目录");
}

function unzipEntries(input: ArrayBuffer | Uint8Array | Buffer): Map<string, Buffer> {
  const buffer = toBuffer(input);
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map<string, ZipEntry>();

  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) throw new Error("XLSX 中央目录损坏");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    entries.set(name, { method, compressedSize, uncompressedSize, localHeaderOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  const files = new Map<string, Buffer>();
  for (const [name, entry] of entries) {
    const local = entry.localHeaderOffset;
    if (buffer.readUInt32LE(local) !== LOCAL_SIGNATURE) throw new Error(`XLSX 本地文件头损坏：${name}`);
    const localNameLength = buffer.readUInt16LE(local + 26);
    const localExtraLength = buffer.readUInt16LE(local + 28);
    const dataStart = local + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
    const content = entry.method === 0
      ? compressed
      : entry.method === 8
        ? inflateRawSync(compressed)
        : undefined;
    if (!content) throw new Error(`XLSX 压缩格式不受支持：${name}`);
    if (entry.uncompressedSize && content.length !== entry.uncompressedSize) {
      throw new Error(`XLSX 文件大小校验失败：${name}`);
    }
    files.set(name, content);
  }
  return files;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function textFromNode(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return decodeXmlEntities(String(value));
  if (Array.isArray(value)) return value.map(textFromNode).join("");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("#text" in record) return textFromNode(record["#text"]);
    if ("t" in record) return textFromNode(record.t);
    if ("r" in record) return textFromNode(record.r);
    return Object.entries(record)
      .filter(([key]) => !key.startsWith("@_"))
      .map(([, child]) => textFromNode(child))
      .join("");
  }
  return "";
}

function parseXml(xml: Buffer): unknown {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    trimValues: false,
    removeNSPrefix: true,
  }).parse(xml.toString("utf8"));
}

function readSharedStrings(files: Map<string, Buffer>): string[] {
  const shared = files.get("xl/sharedStrings.xml");
  if (!shared) return [];
  const root = parseXml(shared) as { sst?: { si?: unknown } };
  return asArray(root.sst?.si).map(textFromNode);
}

function columnIndexFromRef(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0]?.toUpperCase();
  if (!letters) return 0;
  let index = 0;
  for (const char of letters) {
    index = index * 26 + char.charCodeAt(0) - 64;
  }
  return index - 1;
}

function cellValue(cell: Record<string, unknown>, sharedStrings: string[]): string {
  const type = String(cell["@_t"] || "");
  if (type === "inlineStr") return textFromNode(cell.is);
  const raw = textFromNode(cell.v);
  if (type === "s") return sharedStrings[Number(raw)] || "";
  return raw;
}

export async function parseXlsxTable(input: ArrayBuffer | Uint8Array | Buffer): Promise<string[][]> {
  const files = unzipEntries(input);
  const sheet = files.get("xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("XLSX 缺少第一个工作表");

  const sharedStrings = readSharedStrings(files);
  const root = parseXml(sheet) as {
    worksheet?: { sheetData?: { row?: Array<Record<string, unknown>> | Record<string, unknown> } };
  };
  const rows = asArray(root.worksheet?.sheetData?.row);

  return rows.map((row) => {
    const cells = asArray(row.c as Array<Record<string, unknown>> | Record<string, unknown> | undefined);
    const values: string[] = [];
    for (const cell of cells) {
      const ref = String(cell["@_r"] || "");
      values[columnIndexFromRef(ref)] = cellValue(cell, sharedStrings);
    }
    return values.map((value) => value ?? "");
  });
}
