import {
  Boxes,
  ClipboardPenLine,
  FileText,
  LayoutDashboard,
  MessageSquareText,
  PackageSearch,
  ScanSearch,
  UsersRound,
  type LucideProps,
} from "lucide-react";

export function ModuleIcon({ moduleId, ...props }: LucideProps & { moduleId: string }) {
  switch (moduleId) {
    case "inventory": return <PackageSearch {...props} />;
    case "inventoryFlow": return <Boxes {...props} />;
    case "listing": return <FileText {...props} />;
    case "reviews": return <MessageSquareText {...props} />;
    case "sourcing": return <ScanSearch {...props} />;
    case "dataEntry": return <ClipboardPenLine {...props} />;
    case "accounts": return <UsersRound {...props} />;
    default: return <LayoutDashboard {...props} />;
  }
}
