#ifndef MAINWINDOW_H
#define MAINWINDOW_H

#include <QMainWindow>
#include <QLineEdit>
#include <QPushButton>
#include <QLabel>

class MainWindow : public QMainWindow
{
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);
    ~MainWindow();

private slots:
    void onOpenButtonClicked();

private:
    void setupUI();
    QString getLoLAnalyticsUrl(const QString &championName) const;

    QLineEdit *championInput;
    QPushButton *openButton;
    QLabel *titleLabel;
};

#endif // MAINWINDOW_H
