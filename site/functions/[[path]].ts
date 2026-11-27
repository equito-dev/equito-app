// The API lives on the same address as the site until equito.pro is bought: every path listed in public/_routes.json
// reaches this function, which hands the request, unchanged, to the equito-api Worker over a service binding (no public
// Worker URL needed). Every other path is a static file and never runs this code.
type Env = { API: { fetch(req: Request): Promise<Response> } }

export const onRequest = (ctx: { request: Request; env: Env }): Promise<Response> => ctx.env.API.fetch(ctx.request)
