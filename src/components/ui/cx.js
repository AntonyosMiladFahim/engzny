/** Tiny className joiner – avoids pulling in clsx for three call sites. */
export default function cx(...parts) {
    return parts.flat().filter(Boolean).join(' ');
}
