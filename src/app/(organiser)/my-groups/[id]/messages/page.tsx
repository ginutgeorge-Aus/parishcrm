import { renderGroupMessagePage } from "@/components/groups/GroupMessagePage"

/** Organiser sent messages page; guard and layout live in `renderGroupMessagePage`. */
export default function MyGroupMessagesPage(props: Readonly<{ params: Promise<{ id: string }>; searchParams?: Promise<{ before?: string }> }>) {
  return renderGroupMessagePage(props.params, "history", "organiser", props.searchParams)
}
