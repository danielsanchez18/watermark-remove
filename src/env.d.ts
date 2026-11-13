/// <reference types="astro/client" />

import type { ReactNode } from "react";

declare module "*.astro" {
  const Component: (props: Record<string, never>) => ReactNode;
  export default Component;
}
