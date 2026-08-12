import { Container } from "@/components/shared/container";
import { siteConfig } from "@/config/site";

export function AppFooter() {
  return (
    <footer className="border-t py-6">
      <Container className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          {siteConfig.name} — nutrition practice platform for Indian dietitians.
        </p>
        <p>{siteConfig.phase}</p>
      </Container>
    </footer>
  );
}
