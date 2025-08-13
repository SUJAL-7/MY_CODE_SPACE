# DevSpace

DevSpace is an online compiler that spins up a Docker Ubuntu environment on the server. It is built using ReactJS, NodeJS, and ExpressJS. DevSpace provides a seamless coding experience with the ability to install any libraries related to the programming language you are using. 

## Features

- **Language Bar**: Allows users to select any programming language for coding.
- **Code Editor Screen**: A feature-rich editor where users can write their code.
- **Terminal Section**: A fully functional terminal where users can execute shell commands and install libraries using commands like `pip`, `npm`, etc.
- **Run Button**: Executes the code and displays the output in the terminal.
- **Boilerplate Code**: Provides boilerplate code for different programming languages to help users get started quickly.

## How It Works

DevSpace leverages Docker to create an isolated Ubuntu environment. This allows for a highly customizable and flexible development environment where users can install any libraries they need.

![diagram-export-16-06-2024-23_05_06](https://github.com/DeepakS-Github/DevSpace/assets/96366840/053b8c2e-e576-45a4-a6cc-19f2d234fb03)

### WebSocket Integration

The terminal section uses WebSocket to provide real-time command execution. This feature is adapted from another one of my GitHub projects, [CloudShell](https://github.com/DeepakS-Github/CloudShell). For detailed information on how the terminal works, please refer to the README file in the CodeShell repository.

## Screenshots

![image](https://github.com/DeepakS-Github/DevSpace/assets/96366840/fbf05b0e-811f-4683-948f-dbd4ba006383)
![image](https://github.com/DeepakS-Github/DevSpace/assets/96366840/20eca3eb-c294-4d03-a7db-8e0e7aa6faf7)
![image](https://github.com/DeepakS-Github/DevSpace/assets/96366840/aa81f4a9-1570-48af-ab84-5c5aed9134af)


## Installation

To set up DevSpace locally, follow these steps:

1. **Clone the repository**:
    ```bash
    git clone https://github.com/DeepakS-Github/DevSpace
    cd DevSpace
    ```

2. **Start the Docker environment (may take some time)**:
    ```bash
    docker-compose up --build
    ```

## Usage

1. Open your browser and navigate to `http://localhost:3000`.
2. Select your preferred programming language from the language bar.
3. Write your code in the code editor.
4. Use the terminal to execute shell commands or install any necessary libraries.
5. Click the "Run" button to see the output in the terminal.

## Contributing

Contributions are welcome! Please fork this repository and submit pull requests.
