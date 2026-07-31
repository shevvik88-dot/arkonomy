import { C, FONT } from "../../utils/colors";

export default function GlassCard({ children, style = {}, ...rest }) {
  return (
    <div {...rest} style={{ background: C.card, borderRadius: 20, border: `1px solid ${C.border}`, padding: 20, fontFamily: FONT, ...style }}>
      {children}
    </div>
  );
}
