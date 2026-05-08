#!/bin/bash
CRUMB=$(curl -s "http://localhost:8080/crumbIssuer/api/json" -u "admin:admin" | sed 's/.*"crumb":"\([^"]*\)".*/\1/')
echo "Crumb: $CRUMB"

cat > /tmp/job.xml << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<flow-definition plugin="workflow-job">
  <description>SplitX CI/CD Pipeline</description>
  <keepDependencies>false</keepDependencies>
  <properties/>
  <definition class="org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition" plugin="workflow-cps">
    <scm class="hudson.plugins.git.GitSCM" plugin="git">
      <configVersion>2</configVersion>
      <userRemoteConfigs>
        <hudson.plugins.git.UserRemoteConfig>
          <url>https://github.com/Sayandip-Jana-1018/SplitX.git</url>
        </hudson.plugins.git.UserRemoteConfig>
      </userRemoteConfigs>
      <branches>
        <hudson.plugins.git.BranchSpec>
          <name>*/main</name>
        </hudson.plugins.git.BranchSpec>
      </branches>
    </scm>
    <scriptPath>jenkins/Jenkinsfile</scriptPath>
    <lightweight>true</lightweight>
  </definition>
  <triggers/>
  <disabled>false</disabled>
</flow-definition>
EOF

curl -s -X POST "http://localhost:8080/createItem?name=SplitX-Pipeline" \
  -u "admin:admin" \
  -H "Jenkins-Crumb: $CRUMB" \
  -H "Content-Type: application/xml" \
  --data-binary "@/tmp/job.xml"
echo "Done: $?"
