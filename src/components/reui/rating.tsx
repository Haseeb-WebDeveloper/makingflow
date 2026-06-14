"use client"

import { useState } from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { StarIcon } from "lucide-react"

const ratingVariants = cva("flex items-center", {
  variants: {
    size: {
      sm: "gap-2 lg:gap-[0.556vw]",
      default: "gap-2.5 lg:gap-[0.694vw]",
      lg: "gap-3 lg:gap-[0.833vw]",
    },
  },
  defaultVariants: {
    size: "default",
  },
})

const starVariants = cva("", {
  variants: {
    size: {
      sm: "w-4 lg:w-[1.111vw] h-4 lg:h-[1.111vw]",
      default: "w-5 lg:w-[1.389vw] h-5 lg:h-[1.389vw]",
      lg: "w-6 lg:w-[1.667vw] h-6 lg:h-[1.667vw]",
    },
  },
  defaultVariants: {
    size: "default",
  },
})

const valueVariants = cva("text-muted-foreground w-5 lg:w-[1.389vw]", {
  variants: {
    size: {
      sm: "text-xs lg:text-[0.833vw]",
      default: "text-sm lg:text-[0.972vw]",
      lg: "text-base lg:text-[1.111vw]",
    },
  },
  defaultVariants: {
    size: "default",
  },
})

function Rating({
  rating,
  maxRating = 5,
  size,
  className,
  starClassName,
  showValue = false,
  editable = false,
  onRatingChange,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof ratingVariants> & {
    /**
     * Current rating value (supports decimal values for partial stars)
     */
    rating: number
    /**
     * Maximum rating value (number of stars to show)
     */
    maxRating?: number
    /**
     * Whether to show the numeric rating value
     */
    showValue?: boolean
    /**
     * Class name for the value span
     */
    starClassName?: string
    /**
     * Whether the rating is editable (clickable)
     */
    editable?: boolean
    /**
     * Callback function called when rating changes
     */
    onRatingChange?: (rating: number) => void
  }) {
  const [hoveredRating, setHoveredRating] = useState<number | null>(null)
  const displayRating =
    editable && hoveredRating !== null ? hoveredRating : rating

  const handleStarClick = (starRating: number) => {
    if (editable && onRatingChange) {
      onRatingChange(starRating)
    }
  }

  const handleStarMouseEnter = (starRating: number) => {
    if (editable) {
      setHoveredRating(starRating)
    }
  }

  const handleStarMouseLeave = () => {
    if (editable) {
      setHoveredRating(null)
    }
  }

  const renderStars = () => {
    const stars = []

    for (let i = 1; i <= maxRating; i++) {
      const filled = displayRating >= i
      const partiallyFilled = displayRating > i - 1 && displayRating < i
      const fillPercentage = partiallyFilled
        ? (displayRating - (i - 1)) * 100
        : 0

      stars.push(
        <div
          key={i}
          className={cn("relative", editable && "cursor-pointer")}
          onClick={() => handleStarClick(i)}
          onMouseEnter={() => handleStarMouseEnter(i)}
          onMouseLeave={handleStarMouseLeave}
        >
          {/* Background star (empty) */}
          <StarIcon data-slot="rating-star-empty" className={cn(starVariants({ size }), "text-muted-foreground/30")} />

          {/* Filled star */}
          <div
            className="absolute inset-0 overflow-hidden"
            style={{
              width: filled ? "100%" : `${fillPercentage}%`,
            }}
          >
            <StarIcon data-slot="rating-star-filled" className={cn(
                                  starVariants({ size }),
                                  "fill-yellow-400 text-yellow-400"
                                )} />
          </div>
        </div>
      )
    }

    return stars
  }

  return (
    <div
      data-slot="rating"
      className={cn(ratingVariants({ size }), className)}
      {...props}
    >
      <div className="flex items-center">{renderStars()}</div>
      {showValue && (
        <span
          data-slot="rating-value"
          className={cn(valueVariants({ size }), starClassName)}
        >
          {displayRating.toFixed(1)}
        </span>
      )}
    </div>
  )
}

export { Rating }