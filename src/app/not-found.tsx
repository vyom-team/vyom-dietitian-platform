import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-svh items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="type-caption font-medium tracking-wide uppercase">
          404
        </p>
        <h1 className="type-h1 mt-3">Page not found</h1>
        <p className="type-body mt-3 text-pretty text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or may have moved.
        </p>
        <Button className="mt-8" asChild>
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}
