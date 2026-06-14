import {
  Boxes,
  ClipboardPenLine,
  FileText,
  LayoutDashboard,
  MessageSquareText,
  PackageSearch,
  ReceiptText,
  ScanSearch,
  UsersRound,
  type LucideProps,
} from "lucide-react";

export function ModuleIcon({ moduleId, ...props }: LucideProps & { moduleId: string }) {
  switch (moduleId) {
    case "inventory": return <PackageSearch {...props} />;
    case "inventoryFlow": return <Boxes {...props} />;
    case "skuDetails": return <ScanSearch {...props} />;
    case "listing": return <FileText {...props} />;
    case "reviews": return <MessageSquareText {...props} />;
    case "dataEntry": return <ClipboardPenLine {...props} />;
    case "finance": return <ReceiptText {...props} />;
    case "accounts": return <UsersRound {...props} />;
    default: return <LayoutDashboard {...props} />;
  }
}
