import { BestSellersSection } from '../components/home/BestSellersSection'
import { BlogsPreview } from '../components/home/BlogsPreview'
import { CategorySection } from '../components/home/CategorySection'
import { FragranceFinder } from '../components/home/FragranceFinder'
import { HeroSection } from '../components/home/HeroSection'
import { ReviewsSection } from '../components/home/ReviewsSection'
import { ScentNotesSection } from '../components/home/ScentNotesSection'
import { GiftPackagingSection, RoyalCollectionSection } from '../components/home/StorySections'
import { TrustBar } from '../components/home/TrustBar'

export function HomePage() {
  return (
    <>
      <HeroSection />
      <TrustBar />
      <ScentNotesSection />
      <BestSellersSection />
      <CategorySection />
      <FragranceFinder />
      <RoyalCollectionSection />
      <GiftPackagingSection />
      <ReviewsSection />
      <BlogsPreview />
    </>
  )
}
