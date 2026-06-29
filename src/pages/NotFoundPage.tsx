import { Link } from 'react-router-dom'
import { PageHeader } from '../components/common/PageHeader'
import { buttonClasses } from '../utils/buttonClasses'

export function NotFoundPage() {
  return (
    <>
      <PageHeader
        description="The royal corridor you followed does not exist in this boutique prototype."
        eyebrow="404"
        title="Page Not Found"
      />
      <section className="container-lux py-12 text-center">
        <Link className={buttonClasses({})} to="/">
          Return Home
        </Link>
      </section>
    </>
  )
}
