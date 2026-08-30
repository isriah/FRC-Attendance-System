# Public documentation site

`content/` is the public-safe Markdown source for the GitHub Pages operations guide. `build.mjs` produces the deployable static site in `site/`; that output is generated and ignored.

The `Deploy public documentation` GitHub Actions workflow deploys on pushes to `main` that change this directory. The default public URL is `https://isriah.github.io/FRC-Attendance-System/`.

## First-time GitHub setup

After this workflow is merged, a repository administrator must open **Settings → Pages** in the GitHub repository and set **Build and deployment → Source** to **GitHub Actions**. No custom domain is needed. The first successful workflow deployment then publishes the default project URL.

## Public-safety boundary

Do not copy internal operations documentation into this directory wholesale. Never include credentials, tokens, production IDs or endpoints, raw roster data, member contact details, network passwords, or unrestricted administration/recovery instructions. Keep technical and deployment material in the repository’s internal documentation instead.
