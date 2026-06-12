"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import Image from "next/image"
import { cn } from "@/lib/utils"

interface Feature {
  step: string
  title?: string
  content: string
  image: string
  icon?: string
}

interface Tab {
  id: string
  label: string
}

interface StepsSectionProps {
  features: Feature[]
  className?: string
  title?: string
  subtitle?: string
  autoPlayInterval?: number
  tabs?: Tab[]
  activeTab?: string
  onTabChange?: (id: string) => void
}

export function StepsSection({
  features,
  className,
  title = "How to get Started",
  subtitle,
  autoPlayInterval = 4000,
  tabs,
  activeTab,
  onTabChange,
}: StepsSectionProps) {
  // A stack of image layers in display order (oldest first, newest last/on top).
  // Each time we advance we push the next image; it slides up from the bottom and
  // overlaps the previous one, which stays exactly in place underneath.
  const [layers, setLayers] = useState([{ id: 0, index: 0 }])
  const [progress, setProgress] = useState(0)

  const currentFeature = layers[layers.length - 1].index

  useEffect(() => {
    const timer = setInterval(() => {
      if (progress < 100) {
        setProgress((prev) => prev + 100 / (autoPlayInterval / 100))
      } else {
        setLayers((ls) => {
          const last = ls[ls.length - 1]
          const next = (last.index + 1) % features.length
          // Keep only a few layers — anything deeper is fully covered anyway.
          return [...ls, { id: last.id + 1, index: next }].slice(-3)
        })
        setProgress(0)
      }
    }, 100)

    return () => clearInterval(timer)
  }, [progress, features.length, autoPlayInterval])

  // When the feature set swaps (e.g. switching tabs), restart from step one so
  // the new content animates in cleanly instead of resuming mid-sequence.
  useEffect(() => {
    setLayers([{ id: 0, index: 0 }])
    setProgress(0)
  }, [features])

  return (
    <div className={cn("font-custom py-12 md:pt-16 px-4 md:px-12 lg:py-[3.333vw] lg:px-[1.111vw]", className)}>
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-w-[1000px] h-[1000px] lg:max-w-[69.444vw] lg:h-[69.444vw] bg-primary/5 rounded-full blur-3xl"
        style={{ filter: "blur(320px)" }}
      />
      <div className="max-w-7xl lg:max-w-[88.88vw] mx-auto w-full">
        <div className="mb-16 lg:mb-[4.444vw] text-center">
          <h2 className="font-sebenta text-3xl md:text-4xl lg:text-[3.333vw] font-semibold  tracking-tight">
            {title}
          </h2>
          {subtitle ? (
            <p className="mx-auto mt-3 lg:mt-[0.833vw] max-w-md lg:max-w-[31.108vw] font-medium text-base lg:text-[1.2vw] leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          ) : null}

          {tabs && tabs.length > 0 ? (
            <div className="mt-6 lg:mt-[1.667vw] flex justify-center">
              <div className="inline-flex rounded-full border bg-background p-1 lg:p-[0.278vw]">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onTabChange?.(t.id)}
                    aria-pressed={activeTab === t.id}
                    className={cn(
                      "bg-background rounded-full px-5 lg:px-[1.389vw] py-2 lg:py-[0.556vw] text-sm lg:text-[1.042vw] font-semibold transition-colors",
                      activeTab === t.id
                        ? "bg-secondary/50 text-secondary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col md:grid md:grid-cols-2 items-center gap-6 md:gap-10 lg:gap-[2.778vw]">
          <div className="order-2 md:order-1 space-y-8 lg:space-y-[2.222vw]">
            {features.map((feature, index) => (
              <div
                key={index}
                className="flex items-center gap-6 md:gap-8 lg:gap-[2.222vw]"
              >
                {/* Only the number circle highlights to mark the current step;
                    the title/description stay at full (active) colour throughout. */}
                <div
                  className={cn(
                    "w-8 h-8 md:w-10 md:h-10 lg:w-[2.778vw] lg:h-[2.778vw] rounded-full flex shrink-0 items-center justify-center border-2 transition-all duration-700 ease-in-out",
                    index === currentFeature
                      ? "bg-secondary/50 border-secondary text-secondary-foreground scale-110"
                      : "bg-muted border-border text-muted-foreground scale-100",
                  )}
                >
                  {feature.icon && index <= currentFeature ? (
                    <span className="text-lg lg:text-[1.25vw] font-bold">{feature.icon}</span>
                  ) : (
                    <span className="text-lg lg:text-[1.25vw] font-semibold">{index + 1}</span>
                  )}
                </div>

                <div className="flex-1">
                  <h3 className="text-xl md:text-2xl lg:text-[1.667vw] font-bold">
                    {feature.title || feature.step}
                  </h3>
                  <p className="mt-1 lg:mt-[0.278vw] text-sm md:text-lg lg:text-[1.2vw] font-medium leading-relaxed text-muted-foreground">
                    {feature.content}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="order-1 md:order-2 relative h-[200px] md:h-[300px] lg:h-[27.778vw] w-full overflow-hidden rounded-lg lg:rounded-[0.556vw] bg-muted">
            {layers.map((layer, i) => {
              const feature = features[layer.index]
              return (
                <motion.div
                  key={layer.id}
                  className="absolute inset-0 overflow-hidden"
                  style={{ zIndex: i }}
                  // The very first image just appears; every later layer slides up
                  // from the bottom and overlaps whatever is already there.
                  initial={i === 0 ? false : { y: "100%" }}
                  animate={{ y: "0%" }}
                  transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
                >
                  <Image
                    src={feature.image}
                    alt={feature.title || feature.step}
                    className="w-full h-full object-cover"
                    width={1000}
                    height={500}
                    priority={layer.id === 0}
                  />
                </motion.div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
