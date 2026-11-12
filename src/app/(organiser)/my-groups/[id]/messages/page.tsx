import { renderGroupMessagePage } from "@/components/groups/GroupMessagePage"

/** Organiser sent messages page; guard and layout live in `renderGroupMessagePage`. */
export default function MyGroupMessagesPage(props: Readonly<{ params: Promise<{ id: string }> }>) {
  return renderGroupMessagePage(props.params, "history", "organiser")
}
