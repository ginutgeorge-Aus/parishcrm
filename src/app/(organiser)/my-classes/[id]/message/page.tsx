import { renderParentMessagePage } from "@/components/sunday-school/parentMessageView"

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ absent?: string | string[]; sent?: string | string[] }> }

/** Volunteer parent-email page (OSS-14): only classes this login may mark; others 404. */
export default function OrganiserParentMessagePage(props: Readonly<Props>) {
  return renderParentMessagePage(props.params, props.searchParams, "organiser")
}
