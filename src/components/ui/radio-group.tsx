import React from "react";

type RadioContext = {
  value: string;
  onValueChange: (value: string) => void;
};

const Ctx = React.createContext<RadioContext>({
  value: "",
  onValueChange: () => {},
});

export function RadioGroup({
  value,
  onValueChange,
  children,
  className,
  ...props
}: any) {
  return (
    <Ctx.Provider value={{ value, onValueChange }}>
      <div className={className} {...props}>
        {children}
      </div>
    </Ctx.Provider>
  );
}

export function RadioGroupItem({ value, id, ...props }: any) {
  const c = React.useContext(Ctx);
  return (
    <input
      type="radio"
      id={id}
      value={value}
      checked={c.value === value}
      onChange={() => c.onValueChange(value)}
      {...props}
    />
  );
}
