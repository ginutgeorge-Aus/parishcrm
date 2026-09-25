export type BirthdayTemplate = { subject: string; body: string }

export const DEFAULT_BIRTHDAY_TEMPLATE: BirthdayTemplate = {
  subject: "A Birthday Blessing for {firstName}",
  body:
    "Dear {firstName},\n\n" +
    "Happy Birthday! On behalf of your {churchName} family, we send you warm wishes and our prayers on your special day.\n\n" +
    "O Lord, on this birthday of your beloved servant {firstName}, we thank you for the gift of life and for your mercies that have been new every morning.\n\n" +
    "We pray that you will guide {them} in all {their} ways, and grant {them} wisdom, strength, and courage for the year ahead. Bless {them} with good health, peace of mind, and a faithful heart that seeks to serve you and your church.\n\n" +
    "May {they} grow in grace and in the knowledge of our Lord Jesus Christ. Protect {them} from all evil, guide {them} along the path of righteousness, and let your blessing rest upon {them} and {their} family.\n\n" +
    "Grant us all the grace to celebrate life as your gift, and to use our days in service to you and to one another.\n\n" +
    "In the name of the Father, and of the Son, and of the Holy Spirit. Amen.\n\n" +
    "With love and blessings,\n{churchName}",
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

type BirthdayVars = { firstName: string; they: string; them: string; their: string; churchName: string }
function substitute(tpl: string, vars: BirthdayVars): string {
  return tpl.replace(/\{(firstName|they|them|their|churchName)\}/g, (_, key: keyof BirthdayVars) => vars[key])
}

export function renderBirthdayEmail(
  template: BirthdayTemplate,
  vars: BirthdayVars,
): { subject: string; html: string; text: string } {
  const subject = substitute(template.subject, vars)
  const text = substitute(template.body, vars)
  const htmlBody = substitute(
    template.body
      .split("\n")
      .map((line) => escapeHtml(line))
      .join("\n"),
    {
      firstName: escapeHtml(vars.firstName),
      they: escapeHtml(vars.they),
      them: escapeHtml(vars.them),
      their: escapeHtml(vars.their),
      churchName: escapeHtml(vars.churchName),
    },
  ).replace(/\n/g, "<br>")
  // htmlBody is fully escaped above (template lines + substituted vars), so
  // raw interpolation here cannot inject markup.
  // nosemgrep: javascript.express.security.injection.raw-html-format.raw-html-format
  const html = `<div style="font-family:sans-serif;max-width:480px;line-height:1.5;">${htmlBody}</div>`
  return { subject, html, text }
}
