import Link from "next/link";

import { BrandMark } from "@/components/layout/brand-mark";
import { Container } from "@/components/shared/container";
import { marketingNav } from "@/config/navigation";
import { siteConfig } from "@/config/site";

export function MarketingFooter() {
  return (
    <footer className="border-t py-10">
      <Container className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <BrandMark />
          <p className="type-caption max-w-xs">
            Nutrition practice software for Indian dietitians.
          </p>
        </div>

        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
          {marketingNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="type-body-sm rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {item.title}
            </Link>
          ))}
        </nav>
      </Container>
      <Container className="mt-8 border-t pt-6">
        <p className="type-caption">
          {siteConfig.name} — {siteConfig.phase}. Nutrition references: IFCT 2017
          and ICMR-NIN 2020.
        </p>
      </Container>
    </footer>
  );
}
