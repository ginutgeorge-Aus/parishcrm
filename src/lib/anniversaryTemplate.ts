export type AnniversaryTemplate = { subject: string; body: string }

export const DEFAULT_ANNIVERSARY_TEMPLATE: AnniversaryTemplate = {
  subject: "An Anniversary Blessing for {names}",
  body:
    "Dear {names},\n\n" +
    "Happy Anniversary! On behalf of your {churchName} family, we rejoice with you and hold you in our prayers as you celebrate {years} years of marriage.\n\n" +
    "O gracious God, we thank you for the gift of marriage and for your faithfulness in binding together {names} in love.\n\n" +
    "We celebrate this anniversary, marking {years} years of grace, patience, and steadfast commitment. We praise you for the joys you have granted them, for the challenges they have overcome together, and for the deepening bond of their love.\n\n" +
    "Bless their marriage anew. Strengthen the covenant they made before you and this church. Grant them continued wisdom to love and honor one another, to support each other in faith, and to grow together in the knowledge of Christ.\n\n" +
    "Protect their home from discord. Fill it with peace, laughter, and the presence of your Spirit. May their marriage be a living testimony to your love and a blessing to their family and to this congregation.\n\n" +
    "Sustain them in sickness and in health, in plenty and in want, through all the seasons of life. Grant them many more years together, and bring them at last into your eternal kingdom where love knows no end.\n\n" +
    "In the name of the Father, and of the Son, and of the Holy Spirit. Amen.\n\n" +
    "With love and blessings,\n{churchName}",
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
type Vars = { names: string; years: string; churchName: string }
function substitute(tpl: string, vars: Vars): string {
  return tpl.replace(/\{(names|years|churchName)\}/g, (_, k: keyof Vars) => vars[k])
}
export function renderAnniversaryEmail(template: AnniversaryTemplate, vars: Vars): { subject: string; html: string; text: string } {
  const subject = substitute(template.subject, vars)
  const text = substitute(template.body, vars)
  const htmlBody = substitute(
    template.body.split("\n").map((line) => escapeHtml(line)).join("\n"),
    { names: escapeHtml(vars.names), years: escapeHtml(vars.years), churchName: escapeHtml(vars.churchName) },
  ).replace(/\n/g, "<br>")
  // htmlBody fully escaped above — raw interpolation cannot inject markup.
  // nosemgrep: javascript.express.security.injection.raw-html-format.raw-html-format
  const html = `<div style="font-family:sans-serif;max-width:520px;line-height:1.6;">${htmlBody}</div>`
  return { subject, html, text }
}
