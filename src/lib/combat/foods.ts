/** Battle food: HP healed per item and approximate market price (gold). */
export interface Food {
  name: string;
  hp: number;
  quality: string;
  price: number;
}

export const FOODS: Food[] = [
  { name: 'Cooked Cod', hp: 10, quality: 'STANDARD', price: 6 },
  { name: 'Cooked Salmon', hp: 20, quality: 'STANDARD', price: 7 },
  { name: 'Cooked Tuna', hp: 32, quality: 'STANDARD', price: 9 },
  { name: 'Cooked Trout', hp: 40, quality: 'REFINED', price: 15 },
  { name: 'Cooked Perch', hp: 70, quality: 'REFINED', price: 17 },
  { name: 'Cooked Herring', hp: 75, quality: 'REFINED', price: 20 },
  { name: 'Cooked Sardines', hp: 130, quality: 'PREMIUM', price: 26 },
  { name: 'Cooked Lobster', hp: 140, quality: 'PREMIUM', price: 31 },
  { name: 'Cooked Crab', hp: 220, quality: 'PREMIUM', price: 44 },
  { name: 'Cooked Turtle', hp: 325, quality: 'EPIC', price: 55 },
  { name: 'Cooked Stingray', hp: 440, quality: 'EPIC', price: 67 },
  { name: 'Cooked Lantern Fish', hp: 500, quality: 'EPIC', price: 80 },
  { name: 'Cooked Great White Shark', hp: 680, quality: 'EPIC', price: 104 },
];

export const DEFAULT_FOOD = 'Cooked Great White Shark';

export function foodByName(name: string | null | undefined): Food {
  return FOODS.find((f) => f.name === name) ?? FOODS.find((f) => f.name === DEFAULT_FOOD)!;
}
