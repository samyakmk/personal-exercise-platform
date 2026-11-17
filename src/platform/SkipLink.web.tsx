export function SkipLink() {
  return <a href="#trainer-plus-main" tabIndex={0} className="trainer-plus-skip-link" onClick={(event) => {
    const main = document.getElementById('trainer-plus-main');
    if (main) {
      event.preventDefault();
      main.focus();
    }
  }}>Skip to main content</a>;
}
