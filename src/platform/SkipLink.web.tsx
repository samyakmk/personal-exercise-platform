export function SkipLink() {
  return <a href="#repform-main" tabIndex={0} className="repform-skip-link" onClick={(event) => {
    const main = document.getElementById('repform-main');
    if (main) {
      event.preventDefault();
      main.focus();
    }
  }}>Skip to main content</a>;
}
