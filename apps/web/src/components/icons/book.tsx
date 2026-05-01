export function Book(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4 5C4 3.34315 5.34315 2 7 2H20V22H7C5.34315 22 4 20.6569 4 19V5ZM6 19C6 19.5523 6.44772 20 7 20H18V18H7C6.44772 18 6 18.4477 6 19Z"
        fill="currentColor"
      />
    </svg>
  )
}
