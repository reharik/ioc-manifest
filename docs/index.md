---
layout: home

hero:
  name: ioc-manifest
  text: Typed IoC for Awilix, by convention
  tagline: Write factory functions, run the generator, get a fully typed container — no manual registrations. First-class monorepo composition.
  actions:
    - theme: brand
      text: Get started
      link: /guide/introduction
    - theme: alt
      text: Quick start
      link: /guide/quick-start
    - theme: alt
      text: GitHub
      link: https://github.com/reharik/ioc-manifest

features:
  - title: Auto-discovery
    details: Export buildUserService and it's registered as userService returning UserService. No container.register calls, ever.
  - title: Typed end-to-end
    details: container.resolve("userService") returns UserService, not any — a fully typed IocGeneratedCradle generated from your factories.
  - title: Type-safe groups
    details: Declare a collection or object group over a base type and resolve every implementation as a typed array or keyed object — discovered automatically, composed across packages.
  - title: Cross-package composition
    details: Apps in a monorepo compose manifests from multiple packages with no scanning across boundaries, and compile-time externals checks.
  - title: Lifetime-inversion safety
    details: Generation fails when a longer-lived service would freeze a shorter-lived dependency — catching a class of stale-state bugs statically.
  - title: No runtime scanning
    details: The generated manifest is plain TypeScript with static imports. Output is ordinary Awilix — zero lock-in, works in dev and bundled prod.
---
