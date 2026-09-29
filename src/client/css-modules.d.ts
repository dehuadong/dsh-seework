/** CSS Modules type shim for the client bundle (compiled by tsdown). */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
