import Link from "next/link";
import {
  ArrowRight,
  CalendarRange,
  ClipboardList,
  FileText,
  LineChart,
  ShieldCheck,
  Users,
} from "lucide-react";

import { Container } from "@/components/shared/container";
import { Button } from "@/components/ui/button";

/**
 * Marketing home page — foundation only.
 *
 * Establishes the public-facing layout and voice. Deliberately makes no
 * quantified claims (accuracy figures, food counts, customer numbers) since
 * none of that is measurable yet.
 */

const capabilities = [
  {
    icon: ClipboardList,
    title: "Intake and targets",
    body: "Capture client intake and derive nutrition targets from established Indian references.",
  },
  {
    icon: CalendarRange,
    title: "Weekly meal plans",
    body: "Build plans around real Indian meal structure, then edit and version them.",
  },
  {
    icon: FileText,
    title: "Professional exports",
    body: "Share a clean, branded plan document with every client.",
  },
  {
    icon: LineChart,
    title: "Progress tracking",
    body: "Follow adherence and trends after the plan is delivered, not just before.",
  },
];

const steps = [
  {
    title: "Add your client",
    body: "Record intake, goals, preferences, and physiological status.",
  },
  {
    title: "Build the plan",
    body: "Work from calculated targets and a structured Indian food reference.",
  },
  {
    title: "Track what happens next",
    body: "Clients log meals and weight; you see progress and review flags.",
  },
];

export default function MarketingHomePage() {
  return (
    <>
      <section className="border-b py-20 sm:py-28">
        <Container className="max-w-3xl text-center">
          <p className="type-caption inline-flex items-center gap-2 rounded-full border px-3 py-1">
            <ShieldCheck className="size-3.5 text-primary" aria-hidden="true" />
            Built on IFCT 2017 and ICMR-NIN 2020
          </p>
          <h1 className="type-display mt-6">
            Nutrition plans your practice can stand behind
          </h1>
          <p className="type-body-lg mt-5 text-pretty text-muted-foreground">
            Vyom helps Indian dietitians build defensible, India-specific
            nutrition plans faster — and keep tracking clients long after the
            plan is delivered.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button size="lg" asChild>
              <Link href="/register">
                Start free trial
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/dashboard">View the product</Link>
            </Button>
          </div>
          <p className="type-caption mt-4">
            Every nutrient value traces to a published reference. Nothing is
            generated.
          </p>
        </Container>
      </section>

      <section className="border-b py-16 sm:py-20">
        <Container>
          <div className="max-w-2xl">
            <h2 className="type-h2">One place for the whole cycle</h2>
            <p className="type-body mt-3 text-muted-foreground">
              The work currently spread across spreadsheets, calculators, PDFs,
              and chat threads.
            </p>
          </div>
          <div className="mt-10 grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
            {capabilities.map((item) => (
              <div key={item.title} className="bg-card p-6">
                <item.icon
                  className="size-5 text-primary"
                  aria-hidden="true"
                />
                <h3 className="type-h4 mt-4">{item.title}</h3>
                <p className="type-body mt-1.5 text-muted-foreground">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-b py-16 sm:py-20">
        <Container>
          <div className="max-w-2xl">
            <h2 className="type-h2">How it works</h2>
          </div>
          <ol className="mt-10 grid gap-8 sm:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.title}>
                <span className="type-caption flex size-7 items-center justify-center rounded-md border font-medium text-foreground">
                  {index + 1}
                </span>
                <h3 className="type-h4 mt-4">{step.title}</h3>
                <p className="type-body mt-1.5 text-muted-foreground">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section className="py-20">
        <Container className="max-w-2xl text-center">
          <Users className="mx-auto size-6 text-primary" aria-hidden="true" />
          <h2 className="type-h2 mt-5">Built for Indian practice</h2>
          <p className="type-body-lg mt-3 text-pretty text-muted-foreground">
            Indian foods, Indian meal structure, Indian reference data — for solo
            practitioners and clinics alike.
          </p>
          <Button size="lg" className="mt-8" asChild>
            <Link href="/register">
              Start free trial
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </Container>
      </section>
    </>
  );
}
