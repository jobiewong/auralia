export function ExternalLink(props: React.SVGProps<SVGSVGElement>) {
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
        d="M13 3H21V11H19V6.41421L11 14.4142L9.58579 13L17.5858 5H13V3ZM3 5H10V7H5V19H17V14H19V21H3V5Z"
        fill="currentColor"
      />
    </svg>
  )
}
