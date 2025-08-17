import PropTypes from "prop-types";
import FileExplorer from "./FileExplorer";

export default function Sidebar({ tree, onOpenFile, onResyncTree }) {
  return (
    <aside className="bg-gray-800 w-56 min-w-[14rem] h-full flex flex-col border-r border-gray-700">
      <FileExplorer
        tree={tree}
        onOpenFile={onOpenFile}
        onResync={onResyncTree}
      />
    </aside>
  );
}

Sidebar.propTypes = {
  tree: PropTypes.object,
  onOpenFile: PropTypes.func.isRequired,
  onResyncTree: PropTypes.func.isRequired,
};