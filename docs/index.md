---
layout: home

hero:
  name: ioc-manifest
  text: Typed IoC for Awilix, by convention
  tagline: Write factory functions or classes, run the generator, get a fully typed container — no manual registrations. First-class monorepo composition.
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
  - title: Factories or classes
    details: Export buildUserService, or write class UserService implements UserContract. Either is a registration unit; both get the same key, and they mix freely.
  - title: Contracts you declared
    details: A unit's contract is the name you wrote at its contract site — a return annotation or an implements clause — read syntactically. No central registry, no inference from checker normalization.
  - title: Typed end-to-end
    details: container.resolve("userService") returns UserService, not any — a fully typed IocGeneratedCradle generated from your source.
  - title: Type-safe groups
    details: Declare a collection or object group over a base type and resolve every implementation as a typed array or keyed object — discovered automatically, composed across packages.
  - title: Cross-package composition
    details: Apps in a monorepo compose manifests from multiple packages with no scanning across boundaries, and compile-time externals checks.
  - title: Lifetime-inversion safety
    details: Generation fails when a longer-lived service would freeze a shorter-lived dependency — catching a class of stale-state bugs statically.
  - title: No runtime scanning
    details: The generated manifest is plain TypeScript with static imports. Output is ordinary Awilix — zero lock-in, works in dev and bundled prod.
---
