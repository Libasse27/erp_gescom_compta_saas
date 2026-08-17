import * as React from "react";
import { cn } from "@/lib/utils";

// react-hook-form passe un `ref` (field.ref, pour setFocus()/scrollIntoView()
// sur erreur de validation) au travers du Slot Radix de FormControl — un
// composant fonction non enveloppé dans forwardRef le reçoit `undefined`
// silencieusement (avertissement React), cassant ce comportement.
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        data-slot="input"
        className={cn(
          "flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none",
          "placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          "aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
