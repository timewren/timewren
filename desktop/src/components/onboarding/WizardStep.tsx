import { motion } from "framer-motion";

interface WizardStepProps {
  children: React.ReactNode;
  direction: number; // -1 = back, 1 = forward
}

const variants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 200 : -200,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -200 : 200,
    opacity: 0,
  }),
};

/**
 * Reusable wizard step wrapper with Framer Motion slide animation.
 */
export function WizardStep({ children, direction }: WizardStepProps) {
  return (
    <motion.div
      custom={direction}
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ duration: 0.25, ease: "easeInOut" }}
      className="w-full"
    >
      {children}
    </motion.div>
  );
}
