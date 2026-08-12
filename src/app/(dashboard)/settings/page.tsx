import type { Metadata } from "next";

import { SettingsPage } from "@/components/templates/page-templates";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const metadata: Metadata = { title: "Settings" };

/**
 * Reference implementation of the form design system.
 *
 * The controls are inert: nothing submits, nothing persists. This page exists
 * so future forms copy one consistent pattern for labels, descriptions,
 * grouping, and spacing rather than inventing their own.
 */
export default function Settings() {
  return (
    <SettingsPage
      title="Settings"
      description="Manage your practice details and preferences."
    >
      <FieldSet>
        <FieldLegend>Practice details</FieldLegend>
        <FieldDescription>
          Shown on plans and documents you share with clients.
        </FieldDescription>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="practice-name">Practice name</FieldLabel>
            <Input id="practice-name" placeholder="e.g. Healthy Life Clinic" />
            <FieldDescription>
              Appears in the header of exported plans.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="practitioner-name">
              Practitioner name
            </FieldLabel>
            <Input id="practitioner-name" placeholder="Your full name" />
          </Field>

          <Field>
            <FieldLabel htmlFor="timezone">Time zone</FieldLabel>
            <Select>
              <SelectTrigger id="timezone">
                <SelectValue placeholder="Select a time zone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ist">India Standard Time (IST)</SelectItem>
                <SelectItem value="utc">
                  Coordinated Universal Time (UTC)
                </SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>
              Used for follow-up scheduling and log timestamps.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="bio">About your practice</FieldLabel>
            <Textarea
              id="bio"
              rows={4}
              placeholder="A short description clients will see."
            />
          </Field>
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend>Notifications</FieldLegend>
        <FieldDescription>
          Choose when Vyom should let you know about client activity.
        </FieldDescription>
        <FieldGroup>
          <Field orientation="horizontal">
            <FieldContentBlock
              label="Client log alerts"
              description="Notify me when a client logs meals or weight."
              htmlFor="notify-logs"
            />
            <Switch id="notify-logs" />
          </Field>

          <Field orientation="horizontal">
            <FieldContentBlock
              label="Attention flags"
              description="Notify me when a deterministic flag is raised."
              htmlFor="notify-flags"
            />
            <Switch id="notify-flags" defaultChecked />
          </Field>
        </FieldGroup>
      </FieldSet>

      <div className="flex items-center gap-3">
        <Button disabled>Save changes</Button>
        <Button variant="ghost" disabled>
          Cancel
        </Button>
        <p className="type-caption">Saving arrives with the database.</p>
      </div>
    </SettingsPage>
  );
}

function FieldContentBlock({
  label,
  description,
  htmlFor,
}: {
  label: string;
  description: string;
  htmlFor: string;
}) {
  return (
    <div className="space-y-0.5">
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      <FieldDescription>{description}</FieldDescription>
    </div>
  );
}
