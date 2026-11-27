// Equito's public addresses, shared by the API (agent card, discovery) and the site (links, code samples, the static
// facts in index.html). equito.pro is not bought yet, so both live on the Cloudflare Pages address: the API paths there
// are passed to the equito-api Worker (site/functions). On domain day change these two lines to https://equito.pro and
// https://api.equito.pro.
export const SITE_URL = "https://equito.pages.dev";
export const API_URL = "https://equito.pages.dev";
