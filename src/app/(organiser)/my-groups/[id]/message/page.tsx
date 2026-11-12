import { renderGroupMessagePage } from "@/components/groups/GroupMessagePage"

/** Organiser email group page; guard and layout live in `renderGroupMessagePage`. */
export default function MyGroupMessagePage(props: Readonly<{ params: Promise<{ id: string }> }>) {
  return renderGroupMessagePage(props.params, "compose", "organiser")
}
