import { renderGroupMessagePage } from "@/components/groups/GroupMessagePage"

/** Sent messages page; guard and layout live in `renderGroupMessagePage`. */
export default function GroupMessagesPage(props: Readonly<{ params: Promise<{ id: string }>; searchParams?: Promise<{ before?: string }> }>) {
  return renderGroupMessagePage(props.params, "history", "dashboard", props.searchParams)
}
