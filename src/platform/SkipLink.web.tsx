export function SkipLink() {
  return <a href="#liftmorrow-main" tabIndex={0} className="liftmorrow-skip-link" onClick={(event) => {
    const main = document.getElementById('liftmorrow-main');
    if (main) {
      event.preventDefault();
      main.focus();
    }
  }}>Skip to main content</a>;
}
