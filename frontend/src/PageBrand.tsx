import rsystemsLogo from "./assets/rsystems-logo-white.svg";

export default function PageBrand() {
  return (
    <div className="page-brand">
      <div className="brand-mark brand-logo">
        <img src={rsystemsLogo} alt="RSystems" />
      </div>
      <div>
        <h1 className="brand-title">RKive</h1>
        <p className="brand-copy">Internal knowledge assistant</p>
      </div>
    </div>
  );
}
