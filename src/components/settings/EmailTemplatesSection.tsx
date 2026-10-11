"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmailTemplateForm } from "./EmailTemplateForm"
import {
  EMAIL_TEMPLATE_KEYS,
  EMAIL_TEMPLATE_LABELS,
  type EmailTemplateKey,
  type EmailTemplateFields,
} from "@/lib/emailTemplates"

export function EmailTemplatesSection({
  templates,
}: Readonly<{
  templates: Record<EmailTemplateKey, EmailTemplateFields>
}>) {
  return (
    <div>
      <h3 className="text-base font-semibold text-foreground mb-1">Email Templates</h3>
      <Tabs defaultValue={EMAIL_TEMPLATE_KEYS[0]}>
        <TabsList>
          {EMAIL_TEMPLATE_KEYS.map((k) => (
            <TabsTrigger key={k} value={k}>{EMAIL_TEMPLATE_LABELS[k]}</TabsTrigger>
          ))}
        </TabsList>
        {EMAIL_TEMPLATE_KEYS.map((k) => (
          <TabsContent key={k} value={k} forceMount className="mt-4 data-[state=inactive]:hidden">
            <EmailTemplateForm templateKey={k} initial={templates[k]} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
