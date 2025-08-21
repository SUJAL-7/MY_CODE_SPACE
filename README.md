# MY_CODE_SPACE

**MY_CODE_SPACE** is a next-generation, browser-based development environment designed for seamless coding, execution, and workspace management—all inside secure, ephemeral Docker containers. With a modern, intuitive interface and powerful backend architecture, you can code in your favorite languages, run commands, and manage files as if you were working locally, but with the safety and repeatability of the cloud.

---

## 🚀 Why Use MY_CODE_SPACE?

- **All-in-one Cloud Workspace:** Edit, run, and manage code in any major language—no setup required on your local machine.
- **Instant & Isolated:** Each session launches a fresh Ubuntu-based Docker container for complete isolation and freedom to install any package or tool.
- **Real Shell, Real Power:** Full-featured terminal lets you install dependencies, run build tools, and debug just like on your own machine.
- **Modern Developer UX:** Monaco-powered editor, responsive file explorer, dark mode, and streamlined controls for a delightful developer experience.
- **Resource-Smart:** Automatic container cleanup, CPU/memory guards, and idle timeouts keep you and the server safe.

---

## 🧩 Features at a Glance

- **File Explorer:**  
  - Rapid navigation and management of project files/folders  
  - Create, rename, and delete files/directories on the fly
- **Code Editor:**  
  - Monaco editor for VS Code–style editing  
  - Automatic syntax highlighting and language detection  
  - Instant boilerplate templates for supported languages  
  - Multiple language support (JS, Python, C++, Java, more)
- **Integrated Terminal:**  
  - Real-time shell access inside your container  
  - Supports `npm`, `pip`, `apt`, compilers, and custom commands  
  - Output streaming and error feedback
- **Security & Isolation:**  
  - Every session runs in a locked-down, disposable Docker instance  
  - Resource controls (CPU, RAM, idle timeout)
- **Customizable:**  
  - Easily adjust resource limits and environment variables for your needs

---

## 🏗️ System Architecture

- **Frontend:**  
  - React.js (via Vite)  
  - Monaco Editor  
  - Tailwind CSS for rapid UI styling
- **Backend:**  
  - Node.js + Express.js  
  - Dockerode for container orchestration  
  - Real-time WebSocket server for terminal I/O
- **Isolation:**  
  - Each workspace = 1 Docker container  
  - All filesystem and process operations are sandboxed

---

## ⚡ Quick Start

**Prerequisites:**  
- [Docker](https://www.docker.com/get-started) installed and running

### 1. Clone the repository

```bash
git clone https://github.com/SUJAL-7/MY_CODE_SPACE.git
cd MY_CODE_SPACE
```

### 2. Build and launch the workspace

```bash
docker-compose up --build
```

> First build may take a few minutes as images are prepared.

### 3. Access the IDE

Open your browser at:  
[http://localhost:3100](http://localhost:3100)

---

## 📝 How to Use

1. **Browse Files:** Use the sidebar explorer to view and manage your workspace files/folders.
2. **Edit Code:**  
   - Click a file to open and edit it in the Monaco-powered editor.  
   - New files get instant boilerplate for their language.
3. **Work in Terminal:**  
   - Run shell commands, install libraries, or debug with the built-in terminal.
4. **Run Your Code:**  
   - Click the **Run** button to execute the current file; output streams to the terminal.
5. **Customize Environment:**  
   - Adjust language, theme, and workspace as needed for your workflow.

---

## ⚙️ Configuration & Customization

- **Resource Limits:**  
  - Tune CPU/memory/idle limits via `.env` or `docker-compose.yml`.
- **Boilerplate Management:**  
  - Edit `client/public/boiler-plate/` to add or update language starter templates.
- **Workspace Persistence:**  
  - Optionally enable Docker volumes for persistent file storage.

---

## 🤝 Contributing

Pull requests and suggestions are always welcome!  
- Fork the repo  
- Open an issue or feature request  
- Submit your PR—let's make remote coding better together!

---

## 📄 License

This project is released under the MIT License.

---

## 📸 Screenshots

<!-- Add your own screenshots below
Example:
![Code Editor](screenshots/editor.png)
![Terminal](screenshots/terminal.png)
![File Explorer](screenshots/explorer.png)
-->

---

## 👨‍💻 Author

Crafted and maintained by [SUJAL-7](https://github.com/SUJAL-7).