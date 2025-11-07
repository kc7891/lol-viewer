#include "mainwindow.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QDesktopServices>
#include <QUrl>
#include <QMessageBox>
#include <QWidget>

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
{
    setupUI();
    setWindowTitle("LoL Viewer");
    resize(400, 150);
}

MainWindow::~MainWindow()
{
}

void MainWindow::setupUI()
{
    // Create central widget and layout
    QWidget *centralWidget = new QWidget(this);
    QVBoxLayout *mainLayout = new QVBoxLayout(centralWidget);

    // Title label
    titleLabel = new QLabel("Enter Champion Name:", this);
    titleLabel->setStyleSheet("font-size: 14pt; font-weight: bold;");
    mainLayout->addWidget(titleLabel);

    // Input layout
    QHBoxLayout *inputLayout = new QHBoxLayout();

    // Champion name input
    championInput = new QLineEdit(this);
    championInput->setPlaceholderText("e.g., ashe, swain");
    championInput->setStyleSheet("padding: 8px; font-size: 12pt;");
    inputLayout->addWidget(championInput);

    // Open button
    openButton = new QPushButton("Open Build", this);
    openButton->setStyleSheet("padding: 8px 16px; font-size: 12pt;");
    inputLayout->addWidget(openButton);

    mainLayout->addLayout(inputLayout);

    // Connect signal
    connect(openButton, &QPushButton::clicked, this, &MainWindow::onOpenButtonClicked);
    connect(championInput, &QLineEdit::returnPressed, this, &MainWindow::onOpenButtonClicked);

    setCentralWidget(centralWidget);
}

void MainWindow::onOpenButtonClicked()
{
    QString championName = championInput->text().trimmed().toLower();

    if (championName.isEmpty()) {
        QMessageBox::warning(this, "Input Error", "Please enter a champion name.");
        return;
    }

    QString url = getLoLAnalyticsUrl(championName);

    if (QDesktopServices::openUrl(QUrl(url))) {
        championInput->clear();
        championInput->setFocus();
    } else {
        QMessageBox::critical(this, "Error", "Failed to open browser.");
    }
}

QString MainWindow::getLoLAnalyticsUrl(const QString &championName) const
{
    return QString("https://lolalytics.com/lol/%1/build/").arg(championName);
}
