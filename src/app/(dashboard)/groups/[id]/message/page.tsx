import { renderGroupMessagePage } from "@/components/groups/GroupMessagePage"

/** Email group page; guard and layout live in `renderGroupMessagePage`. */
export default function GroupMessagePage(props: Readonly<{ params: Promise<{ id: string }> }>) {
  return renderGroupMessagePage(props.params, "compose", "dashboard")
}
