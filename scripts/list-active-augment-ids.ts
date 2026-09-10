import { AUGMENTS } from "@/lib/augments/catalog";

const ids = AUGMENTS.map((augment) => augment.id).sort((a, b) => a.localeCompare(b));
console.log(JSON.stringify(ids));
