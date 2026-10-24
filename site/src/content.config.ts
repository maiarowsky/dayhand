// The documentation pages are the docs/*.md files of the repository that src/docs/pages.ts lists, read as
// they are: the same files GitHub shows. An entry's id is its file name, such as `deploy.md`.
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { PAGES } from "./docs/pages.ts";

export const collections = {
  docs: defineCollection({
    loader: glob({ pattern: PAGES.map((page) => page.src), base: "../docs", generateId: ({ entry }) => entry }),
  }),
};
