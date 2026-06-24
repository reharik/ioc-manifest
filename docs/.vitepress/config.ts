import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "ioc-manifest",
  description:
    "Convention-based dependency discovery and codegen for Awilix. Typed IoC containers with first-class monorepo composition.",

  // GitHub Project Pages are served from /<repo>/ — drop this if you move to a custom domain or user/org page.
  base: "/ioc-manifest/",

  cleanUrls: true,
  lastUpdated: true,

  head: [
    ["meta", { name: "theme-color", content: "#3c8772" }],
  ],

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: "Guide", link: "/guide/introduction" },
      { text: "Config", link: "/config/reference" },
      { text: "Monorepo", link: "/monorepo/composition" },
      {
        text: "Reference",
        items: [
          { text: "CLI", link: "/reference/cli" },
          { text: "Error handling", link: "/reference/errors" },
          { text: "Pitfalls & troubleshooting", link: "/reference/pitfalls" },
        ],
      },
    ],

    sidebar: [
      {
        text: "Getting started",
        items: [
          { text: "Introduction", link: "/guide/introduction" },
          { text: "Quick start", link: "/guide/quick-start" },
          { text: "What gets generated", link: "/guide/what-gets-generated" },
        ],
      },
      {
        text: "Core concepts",
        items: [
          { text: "How conventions work", link: "/concepts/conventions" },
          { text: "Lifetimes", link: "/concepts/lifetimes" },
          { text: "Groups", link: "/concepts/groups" },
        ],
      },
      {
        text: "Configuration",
        items: [
          { text: "ioc.config.ts reference", link: "/config/reference" },
        ],
      },
      {
        text: "Monorepo",
        items: [
          { text: "Cross-package composition", link: "/monorepo/composition" },
        ],
      },
      {
        text: "Builds & testing",
        items: [
          { text: "Dev & production builds", link: "/guide/builds" },
          { text: "Testing", link: "/guide/testing" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "CLI", link: "/reference/cli" },
          { text: "Error handling", link: "/reference/errors" },
          { text: "Pitfalls & troubleshooting", link: "/reference/pitfalls" },
        ],
      },
      {
        text: "About",
        items: [
          { text: "Design philosophy", link: "/about/philosophy" },
        ],
      },
    ],

    search: {
      provider: "local",
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/reharik/ioc-manifest" },
    ],

    editLink: {
      pattern:
        "https://github.com/reharik/ioc-manifest/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © reharik",
    },
  },
});
