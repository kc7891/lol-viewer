#include "mainwindow.h"
#include <QApplication>
#include <QDebug>
#include <iostream>

int main(int argc, char *argv[])
{
    try {
        std::cout << "Starting LoL Viewer..." << std::endl;

        QApplication app(argc, argv);
        std::cout << "QApplication created" << std::endl;

        MainWindow window;
        std::cout << "MainWindow created" << std::endl;

        window.show();
        std::cout << "Window shown" << std::endl;

        return app.exec();
    } catch (const std::exception& e) {
        std::cerr << "Exception caught: " << e.what() << std::endl;
        return 1;
    } catch (...) {
        std::cerr << "Unknown exception caught" << std::endl;
        return 1;
    }
}
