export function ArrowLeft({ ...props }: {} & React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      {...props}
    >
      <title>Arrow Left</title>
      <path
        d="M10 6L4 12L10 18"
        stroke="currentColor"
        strokeWidth="inherit"
        strokeLinecap="square"
      />
      <path
        d="M5 12H20"
        stroke="currentColor"
        strokeWidth="inherit"
        strokeLinecap="square"
      />
    </svg>
  )
}
