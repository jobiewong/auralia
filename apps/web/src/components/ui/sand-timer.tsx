export function SandTimer({ ...props }: {} & React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      {...props}
    >
      <path
        d="M12 12L6 8V3H18V8L12 12ZM12 12L18 16V21H6V16L12 12Z"
        stroke="currentColor"
        strokeWidth="inherit"
        strokeLinecap="square"
      />
      <path
        d="M20 21H4"
        stroke="currentColor"
        strokeWidth="inherit"
        strokeLinecap="square"
      />
      <path
        d="M20 3H4"
        stroke="currentColor"
        strokeWidth="inherit"
        strokeLinecap="square"
      />
    </svg>
  )
}
