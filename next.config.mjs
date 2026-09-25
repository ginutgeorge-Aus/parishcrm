/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Suppress X-Powered-By — framework fingerprinting.
  poweredByHeader: false,
  // pdfkit's CJS build reads its standard-14 font metrics from disk at runtime
  // (`fs.readFileSync(__dirname + '/data/Helvetica.afm')`). Keep it external so
  // __dirname resolves to the real node_modules copy (webpack-bundling it breaks
  // that path), and trace the font data in below — same pattern as unpdf/pdfjs.
  serverExternalPackages: ["unpdf", "pdfjs-dist", "pdfkit", "@prisma/client", "bcryptjs", "nodemailer", "@azure/monitor-opentelemetry"],
  // File uploads (event images) exceed the 1 MB server-action default (#event-poster).
  experimental: {
    // Two images (banner + poster) can each be up to 2 MB (MAX_IMAGE_BYTES in
    // src/lib/actions/eventForm.ts, lowered from 5 MB by); a single submit
    // setting both must fit under this cap plus multipart overhead, else Next
    // rejects the body before the action's own {error} validation can run.
    //
    // Next has no per-action override for this setting — it applies to
    // EVERY `use server` action, including the public unauth ones
    // (submitMembershipApplication/submitFamilyUpdate/startEventCheckout).
    // Those public actions no longer buffer up to this cap: middleware rejects
    // any public-path POST over MAX_PUBLIC_BODY_BYTES (1 MB) before Next buffers
    // it (`publicBodyTooLarge`, src/lib/bodyLimit.ts) — the per-path override
    // Next lacks. This cap now serves only the admin-only event-image upload
    // (2 MB × 2 images + multipart overhead); was 11mb before halved the
    // per-image cap.
    serverActions: { bodySizeLimit: "5mb" },
  },
  outputFileTracingIncludes: {
    "/api/import/bank-statement": [
      "./node_modules/unpdf/**/*",
      "./node_modules/pdfjs-dist/**/*",
    ],
    // DGR receipt PDF (pdfkit) — the send server action lives on the list page,
    // the download is its own route. Both need pdfkit's .afm font data on disk,
    // which the tracer misses (dynamic __dirname path). note in dgrReceipt.ts.
    "/accounting/dgr-receipts": ["./node_modules/pdfkit/**/*"],
    "/accounting/dgr-receipts/[id]/pdf": ["./node_modules/pdfkit/**/*"],
    // Public membership form: submit action renders the application PDF (pdfkit)
    // for the secretary email attachment — same .afm font tracing need.
    "/membershipform": ["./node_modules/pdfkit/**/*"],
  },
  // Security headers (HSTS, X-Content-Type-Options, X-Frame-Options,
  // Referrer-Policy, Permissions-Policy) and CSP are both set per-request in
  // src/middleware.ts (SECURITY_HEADERS + buildCsp). next.config `headers()` does
  // not reach App-Router Route Handlers, so setting them here left API responses
  // uncovered; middleware runs on every non-static route and covers both.
  //
  // BUT the middleware matcher deliberately excludes `_next/static`, `_next/image`
  // and `favicon.ico`, so those subresources carried no security headers.
  // next.config `headers()` DOES reach static assets (they are not Route Handlers),
  // so apply the MITM-relevant subset here: nosniff (block MIME-sniffing of JS/CSS)
  // + HSTS (block downgrade-to-http on a subresource fetch). Framing/permissions
  // headers don't apply to non-document subresources, so they're omitted.
  async headers() {
    const assetHeaders = [
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ];
    return [
      { source: "/_next/static/:path*", headers: assetHeaders },
      { source: "/_next/image/:path*", headers: assetHeaders },
      { source: "/favicon.ico", headers: assetHeaders },
    ];
  },
};

export default nextConfig;
