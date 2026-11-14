import { renderParentMessagePage } from "@/components/sunday-school/parentMessageView"

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ absent?: string | string[]; sent?: string | string[] }> }

/** Staff parent-email page (OSS-14); guard and layout live in `renderParentMessagePage`. */
export default function ClassParentMessagePage(props: Readonly<Props>) {
  return renderParentMessagePage(props.params, props.searchParams, "dashboard")
}
