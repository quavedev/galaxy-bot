# CI
Usually you will run Galaxy Bot (galaxy-bot) in a CI server to have it running all the
 time.

## How to set up your CI

### Jenkins

[JobDSL](https://jenkinsci.github.io/job-dsl-plugin/) plugin is a great way to configure Jenkins
 without using the UI, this way you will have code setting up Jenkins for you automatically.
 
 First make sure you have galaxy-bot installed in your CI server
 `yarn global add @quave/galaxy-bot`, ideally you would create a job also for
  this then you could easily update.
  
 Follow one example of how to set up `galaxy-bot` with this plugin to run every two minutes to auto
 -scale two different apps.
```
def generatedBy = "Generated by groovy using JobDSL plugin at ${new Date()}"
job("meteor_galaxy_auto_scaling") {
    description generatedBy
    scm {
        git("git@github.com:org/repo.git", "master")
    }

    triggers {
        cron("*/2 * * * *")
    }

    wrappers {
        timeout {
            absolute(minutes = 10)
        }
    }

    steps {
        shell("""
            `yarn global bin`/galaxy-bot --settings path/to/settings/in/your/workspace/app1.json
            `yarn global bin`/galaxy-bot --settings path/to/settings/in/your/workspace/app2.json
        """)
    }
    configure {
        it / 'publishers' / 'jenkins.plugins.slack.SlackNotifier'(plugin: "slack@2.3") {
            notifyFailure(true)
            notifyBackToNormal(true)
            notifyRepeatedFailure(true)
        }
    }
}
```

You can also include a label setting if you want to run this process in a different Jenkins slave
 node. 
```
    label('galaxy-bot')
```

### Other CIs
If you are using other CI and you need help please open an issue or open a PR to include the
 instructions here on how to setup `galaxy-bot` in your CI.
